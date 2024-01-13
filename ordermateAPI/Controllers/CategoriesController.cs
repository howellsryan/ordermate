using Microsoft.AspNetCore.Mvc;
using ordermateAPI.Models;
using ordermateAPI.Services.Interfaces;

namespace ordermateAPI.Controllers;

[ApiController]
[Route("api/[controller]")]
public class CategoriesController : ControllerBase
{
    private readonly ILogger<CategoriesController> _logger;
    private readonly ICategoryService _categoryService;

    public CategoriesController(ILogger<CategoriesController> logger, ICategoryService categoryService)
    {
        _logger = logger;
        _categoryService = categoryService;
    }

    [HttpGet]
    public async Task<ActionResult<List<ProductModel>>> Get()
    {
        try
        {
            var categories = await _categoryService.Get();

            return Ok(categories);
        }
        catch (Exception e)
        {
            return BadRequest(e.Message);
        }
    }

    [HttpGet("{id}")]
    public async Task<ActionResult<ProductModel>> Get(int id)
    {
        try
        {
            var category = await _categoryService.Get(id);

            return Ok(category);
        }
        catch (Exception e)
        {
            return BadRequest(e.Message);
        }
    }
}