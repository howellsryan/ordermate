using ordermateAPI.DAL.Interfaces;
using ordermateAPI.Exceptions;
using ordermateAPI.Models;
using ordermateAPI.Services.Interfaces;

namespace ordermateAPI.Services;

public class ProductService : IProductService
{
    private readonly IProductRepository _productRepository;
    private readonly IProductOptionService _productOptionService;

    public ProductService(IProductRepository productRepository, IProductOptionService productOptionService)
    {
        _productRepository = productRepository;
        _productOptionService = productOptionService;
    }

    public async Task<ProductModel> Get(int id)
    {
        var product = await _productRepository.Get(id);
        if (product == null)
            throw new ProductNotFoundException($"Product with Id {id} not found.");

        ProductModel result = await MapDalObjectToApiModel(product);
        await SetProductOptions(result);
        
        return result;
    }

    public async Task<List<ProductModel>> Get()
    {
        var products = await _productRepository.Get();

        return await MapResultsToApi(products);
    }

    public async Task<List<ProductModel>> GetByCategoryId(int categoryId)
    {
        var products = await _productRepository.GetByCategoryId(categoryId);

        return await MapResultsToApi(products);
    }

    private async Task<List<ProductModel>> MapResultsToApi(IEnumerable<DAL.Models.ProductModel> dataModel)
    {
        var result = new List<ProductModel>();

        foreach (var dalProduct in dataModel)
        {
            result.Add(await MapDalObjectToApiModel(dalProduct));
        }

        return result;
    }

    private async Task<ProductModel> MapDalObjectToApiModel(DAL.Models.ProductModel dalProduct)
    {
        var result = new ProductModel
        {
            ProductId = dalProduct.ProductId,
            CategoryId = dalProduct.CategoryId,
            StoreId = dalProduct.StoreId,
            Name = dalProduct.Name,
            Description = dalProduct.Description,
            Image = dalProduct.Image,
            LastModifiedDate = dalProduct.LastModifiedDate,
            CreatedDate = dalProduct.CreatedDate
        };

        await SetProductOptions(result);
        return result;
    }

    private async Task SetProductOptions(ProductModel product)
    {
        product.ProductOptions = await _productOptionService.GetByProductId(product.ProductId);
    }
}