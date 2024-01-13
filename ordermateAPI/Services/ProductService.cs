using ordermateAPI.DAL.Interfaces;
using ordermateAPI.Models;
using ordermateAPI.Services.Interfaces;

namespace ordermateAPI.Services;

public class ProductService : IProductService
{
    private readonly IProductRepository _productRepository;

    public ProductService(IProductRepository productRepository)
    {
        _productRepository = productRepository;
    }

    public async Task<ProductModel> Get(int id)
    {
        var dataModel = await _productRepository.Get(id);
        if (dataModel == null)
            throw new Exception($"Product with Id {id} not found.");

        return MapDalObjectToApiModel(dataModel);
    }

    public async Task<List<ProductModel>> Get()
    {
        var products = await _productRepository.Get();

        return MapResultsToApi(products);
    }

    public async Task<List<ProductModel>> GetByCategoryId(int categoryId)
    {
        var products = await _productRepository.GetByCategoryId(categoryId);

        return MapResultsToApi(products);
    }

    private List<ProductModel> MapResultsToApi(IEnumerable<DAL.Models.ProductModel> dataModel)
    {
        var result = new List<ProductModel>();

        foreach (var dalProduct in dataModel)
        {
            result.Add(MapDalObjectToApiModel(dalProduct));
        }

        return result;
    }

    private ProductModel MapDalObjectToApiModel(DAL.Models.ProductModel dalProduct)
    {
        return new ProductModel
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
    }
}