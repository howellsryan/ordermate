using ordermateAPI.DAL.Interfaces;
using ordermateAPI.Exceptions;
using ordermateAPI.Models;
using ordermateAPI.Services.Interfaces;

namespace ordermateAPI.Services;

public class CategoryService : ICategoryService
{
    private readonly ICategoryRepository _categoryRepository;
    private readonly IProductService _productService;
    
    public CategoryService(ICategoryRepository categoryRepository, IProductService productService)
    {
        _categoryRepository = categoryRepository;
        _productService = productService;
    }
    
    public async Task<CategoryModel> Get(int id)
    {
        var category = await _categoryRepository.Get(id);
        if (category == null)
            throw new ProductNotFoundException($"Product with Id {id} not found.");

        List<ProductModel> categoryProducts = await _productService.GetByCategoryId(category.CategoryId);
        
        return new CategoryModel
        {
            CategoryId = category.CategoryId,
            StoreId = category.StoreId,
            Name = category.Name,
            Description = category.Description,
            Image = category.Image,
            Products = categoryProducts,
            LastModifiedDate = category.LastModifiedDate,
            CreatedDate = category.CreatedDate
        };
    }
    
    public async Task<List<CategoryModel>> Get()
    {
        List<CategoryModel> result = new List<CategoryModel>();
        var categories = await _categoryRepository.Get();
        
        foreach (var category in categories)
        {
            List<ProductModel> categoryProducts = await _productService.GetByCategoryId(category.CategoryId);
            result.Add(new CategoryModel
            {
                CategoryId = category.CategoryId,
                StoreId = category.StoreId,
                Name = category.Name,
                Description = category.Description,
                Image = category.Image,
                Products = categoryProducts,
                LastModifiedDate = category.LastModifiedDate,
                CreatedDate = category.CreatedDate
            });
        }

        return result;
    }
}